/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.Random;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 *
 * @author jihad
 */
public class Player extends Character {

    Random rand = new Random();
    public static boolean isLevelUp = false;

    //additional variables
    int gold, restsLeft, pots;

    public Armor equippedArmor;
    public Weapon equippedWeapon;

    public String classPlayer;

    static Dice hitDiePlayer, hitDiePlayerTotal;
    int proficiency;

    //upgrades variables
    public int numAtkUpgrades, numDefUpgrades;

    public String[] atkUpgrades = {"Strength", "Power", "Might", "Warlike"};
    public String[] defUpgrades = {"Heavy Bones", "Stoneskin", "Scale Armor", "Holy Armor"};

    //constructor
    public Player(String name) {
        //calling constructor of superclass
        super(name, 0, 150); //name maxhp xp

        //setting #upgrades to 0
        this.numAtkUpgrades = 0;
        this.numDefUpgrades = 0;

        //player stats
        //set additional stats
        this.gold = 1500;
        this.restsLeft = 1;
        this.pots = 2;
        //let player choose trait when creating character

        this.proficiency = 2; //applied to: atk rolls(proficient weapons, and spells you cast)
        chooseClass();
        rollStartStats();
        setMods();

        System.out.println(classPlayer);

//        levelUp();
    }

    public void rollStartStats() {
        //were to roll a d6 4 times, pick 3 highest, and add them to an array. then from this array, player can arrange it as he wishes, player can also re-roll
        //pseudo code
        //for loop 6 iterations{
        //rolldice 4d6, add 3 highest to array as next index
        //display all indexes in the GameLogic.readInt()
//STR,DEX,CON,INT,WIS,CHA,

        boolean startStatsSet = false;
        do {
            for (int i = 0; i < 6; i++) {
                int roll = Dice.rollDice(Dice.startStatsDice);
                roll -= Dice.startStatsDice.smallestRoll;
                Stats[i] = roll;
                System.out.println(Stats[i]); //debug
            }

            GameLogic.printHeader("YOUR ROLLS", true);
            System.out.println("STR: " + Stats[0] + "\nDEX: " + Stats[1] + "\nCON: " + Stats[2] + "\nINT: " + Stats[3] + "\nWIS: " + Stats[4] + "\nCHA: " + Stats[5]);
            System.out.println("Do you want to have these attributes?\n(1) Yes, looking good!\n(2) No, re-roll them!");
            int input = GameLogic.readInt("-> ", 2);

            if (input == 1) {
                startStatsSet = true;
            } else {
                System.out.println("Re-rolling stats. . .");
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException ex) {
                    Logger.getLogger(Player.class.getName()).log(Level.SEVERE, null, ex);
                }
            }

        } while (!startStatsSet);

        //might not need this
        GameLogic.anythingToContinue();

    }

    // player specific methods
    public void levelUp() {
        String[] choicePicked = {"", "", "", "", "", ""};
        int i = 1;

        do {
            int j = i;
            if (i == 3) {
                j = 2;
            }
            GameLogic.printHeader("Choose an attribute to upgrade (" + j + "/2)", true);
            System.out.println("(1) STR" + choicePicked[0]);
            System.out.println("(2) DEX" + choicePicked[1]);
            System.out.println("(3) CON" + choicePicked[2]);
            System.out.println("(4) INT" + choicePicked[3]);
            System.out.println("(5) WIS" + choicePicked[4]);
            System.out.println("(6) CHA" + choicePicked[5]);

            if (i <= 2) {
                int input = GameLogic.readInt("-> ", 6);

                for (int k = 0; k < 6; k++) {
                    if (input == k + 1) {
                        choicePicked[k] += "+";
                        Stats[k]++;
                    }
                }
            }

            i++;
        } while (i <= 3);

        //isLevelUp is used here to define if setMods will be called as a LevelUp
        isLevelUp = true;
        setMods();
        isLevelUp = false;

        proficiency++;

//        System.out.println("STR: " + Stats[0] + " (" + StatsMods[0] + ")" + "\tDEX: " + Stats[1] + " (" + StatsMods[1] + ")"
//                + "\nCON: " + Stats[2] + " (" + StatsMods[2] + ")" + "\tINT: " + Stats[3] + " (" + StatsMods[3] + ")"
//                + "\nWIS: " + Stats[4] + " (" + StatsMods[4] + ")" + "\tCHA: " + Stats[5] + " (" + StatsMods[5] + ")");
        GameLogic.anythingToContinue();
    }

    // UNDER DEVELOPMENT
    public void chooseClass() {
        GameLogic.clearConsole();
        boolean classSet = false;

        do {
            GameLogic.printHeader("CHOOSE YOUR CLASS", true); //SOLO -> WARRIOR   ---- TECHIES -> WIZARD(kind of)
            System.out.println("(1) Solo\n(2) Techie");
            int input = GameLogic.readInt("-> ", 2);

            if (input == 1) {
                classPlayer = "Solo";
                hitDiePlayer = Dice.d10; //Fighter
                this.equippedArmor = Armor.testArmor11;
                this.equippedWeapon = Weapon.testWeapon11;
            } else if (input == 2) {
                classPlayer = "Neuromancer";//some sort of psychic based on wizard class
                hitDiePlayer = Dice.d6; //wizard
                this.equippedArmor = Armor.testArmor21;
                this.equippedWeapon = Weapon.testWeapon21;
            }

            GameLogic.clearConsole();

            System.out.println("Are you sure you want to be a " + classPlayer + "?");
            System.out.println("(1) Yeah!\n(2) Go back, go back!");
            input = GameLogic.readInt("-> ", 2);

            if (input == 1) {
                classSet = true;
            } else if (input == 2) {

            }

        } while (!classSet);

    }

    public void setHitDie() {

    }

    //ATTACK AND DEFEND NEED REWORK
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
