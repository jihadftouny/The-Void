/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *
 * @author jihad
 */
public class Player extends Character{

    //additional variables
    int gold, restsLeft, pots;
    
    
    //upgrades variables
    public int numAtkUpgrades, numDefUpgrades;
    
    public String[] atkUpgrades = {"Strength","Power","Might","Warlike"};
    public String[] defUpgrades = {"Heavy Bones","Stoneskin","Scale Armor","Holy Armor"};
        
    //constructor
    public Player(String name) { 
        //calling constructor of superclass
        super(name, 100, 0);
        
        //setting #upgrades to 0
       this.numAtkUpgrades = 0;
       this.numDefUpgrades = 0;
       
       //set additional stats
       this.gold = 5;
       this.restsLeft = 1;
       this.pots = 5;
       //let player choose trait when creating character
       chooseTrait();
        
    }

    
    // player specific methods
    
    public void chooseTrait(){
        GameLogic.clearConsole();
        GameLogic.printHeader("Choose an upgrade", true);
        System.out.println("(1) " + atkUpgrades[numAtkUpgrades]);
        System.out.println("(2) " + defUpgrades[numDefUpgrades]);
       int input = GameLogic.readInt("-> ", 2);
        
        if(input == 1){
            GameLogic.clearConsole();
            System.out.println("You chose " + atkUpgrades[numAtkUpgrades] + ".");
            numAtkUpgrades++;
        }else{
            GameLogic.clearConsole();
            System.out.println("You chose " + defUpgrades[numDefUpgrades] + ".");
            numDefUpgrades++;
        }
        GameLogic.anythingToContinue();
    }
    
    
    @Override
    public int attack() {
        return (int) (Math.random()*(xp/4 + numDefUpgrades*3 +3) + xp/10 + numDefUpgrades*2 + numAtkUpgrades +1);
    }

    @Override
    public int defend() {
        return (int) (Math.random()*(xp/4 + numDefUpgrades*3 +3) + xp/10 + numDefUpgrades*2 + numAtkUpgrades +1);
    }
    
    
    
}
