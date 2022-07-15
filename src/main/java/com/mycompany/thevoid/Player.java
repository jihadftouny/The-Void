/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.Random;

/**
 *
 * @author jihad
 */
public class Player extends Character {

    Random rand = new Random();

    //additional variables
    int gold, restsLeft, pots;

    //upgrades variables
    public int numAtkUpgrades, numDefUpgrades;

    public String[] atkUpgrades = {"Strength", "Power", "Might", "Warlike"};
    public String[] defUpgrades = {"Heavy Bones", "Stoneskin", "Scale Armor", "Holy Armor"};

    //constructor
    public Player(String name) {
        //calling constructor of superclass
        super(name, 10, 0); //name maxhp xp

        //setting #upgrades to 0
        this.numAtkUpgrades = 0;
        this.numDefUpgrades = 0;

        //player stats
        //set additional stats
        this.gold = 5;
        this.restsLeft = 1;
        this.pots = 2;
        //let player choose trait when creating character
        chooseStartStats();
//        chooseTrait();

    }

    public void chooseStartStats() {
        //were to roll a d6 4 times, pick 3 highest, and add them to an array. then from this array, player can arrange it as he wishes, player can also re-roll
        //pseudo code
        //for loop 6 iterations{
        //rolldice 4d6, add 3 highest to array as next index
        //display all indexes in the GameLogic.readInt()
        int[] StartRolls = new int[]{0,0,0,0,0,0};

        for (int i = 0; i < 6; i++) {
            int roll = Dice.rollDice(Dice.startStatsDice);
            roll -= Dice.startStatsDice.smallestRoll;
            StartRolls[i] = roll;
            System.out.println(StartRolls[i]); //debug
        }
        GameLogic.printHeader("YOUR ROLLS", true);
        System.out.println(StartRolls[0] + " - " + StartRolls[1] + " - " + StartRolls[2] + " - " + StartRolls[3] + " - " + StartRolls[4] + " - " + StartRolls[5]);
    }

    // player specific methods
    public void chooseTrait() {
        GameLogic.clearConsole();
        int roll = Dice.rollDice(Dice.d10);
        GameLogic.printHeader("Choose an upgrade", true);
        System.out.println("(1) " + atkUpgrades[numAtkUpgrades]);
        System.out.println("(2) " + defUpgrades[numDefUpgrades]);
        int input = GameLogic.readInt("-> ", 2);

        if (input == 1) {
            GameLogic.clearConsole();
            System.out.println("You chose " + atkUpgrades[numAtkUpgrades] + ".");
            numAtkUpgrades++;
            Stats[0] += roll;
        } else {
            GameLogic.clearConsole();
            System.out.println("You chose " + defUpgrades[numDefUpgrades] + ".");
            numDefUpgrades++;
            Stats[1] += roll;
        }
        System.out.println("roll: " + roll + "\n ATK: " + Stats[0] + " DEF: " + Stats[1]);
        GameLogic.anythingToContinue();
    }

    @Override
    public int attack() {

        return rand.nextInt(Stats[0]);
//        return (int) (Math.random()*(xp/4 + numAtkUpgrades*3 +3) + xp/10 + numAtkUpgrades*2 + numDefUpgrades +1);
    }

    @Override
    public int defend() {
        return rand.nextInt(Stats[1]);
//        return (int) (Math.random() * (xp / 4 + numDefUpgrades * 3 + 3) + xp / 10 + numDefUpgrades * 2 + numAtkUpgrades + 1);
    }

}
