/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.ArrayList;
import java.util.Random;

/**
 *
 * @author jihad
 */
public class EnemyName {

    String type, firstName, middleName, lastName, fullName;

    public EnemyName(String type) {
        this.type = type;
        fullName = setName();
    }

    public String setName() {
        String returnedName = "";

        // arrays will store names eg. "Feral Electrified Lizard"
        ArrayList<String> firstName = new ArrayList<String>();
        ArrayList<String> middleName = new ArrayList<String>();
        ArrayList<String> lastName = new ArrayList<String>();

        // stores the weights of each names, must be declared manually
        ArrayList<Integer> weightFirst = new ArrayList<Integer>();
        ArrayList<Integer> weightMiddle = new ArrayList<Integer>();
        ArrayList<Integer> weightLast = new ArrayList<Integer>();


        if ("Beast".equals(type)) {
            //STATS mods
            firstName.add("Feral");// add dmg
            weightFirst.add(20);
            firstName.add("Aerobicized");
            weightFirst.add(20);// add hp
            firstName.add("Plated");
            weightFirst.add(20);// add AC

            firstName.add("Bestial"); // add dmg + hp
            weightFirst.add(10);
            firstName.add("Unbreakable"); // add hp + AC
            weightFirst.add(10);
            firstName.add("Cunning"); // add AC + dmg
            weightFirst.add(10);

            firstName.add("Giant"); // add dmg + hp + AC
            weightFirst.add(5);
            firstName.add("Monstrous"); // add dmg + hp + AC A LOT
            weightFirst.add(3);
            firstName.add("Mutated"); // immunity to some elements, equivalent to UNDEAD
            weightFirst.add(2);

            // Elementals
            middleName.add("Cryo"); // Ice
            weightMiddle.add(20);
            middleName.add("Fiery"); // Fire
            weightMiddle.add(20);
            middleName.add("Electrified"); // Electro
            weightMiddle.add(20);
            middleName.add("Venomous"); // Poison
            weightMiddle.add(20);
            middleName.add("Psychogenic"); // Psychic
            weightMiddle.add(20);

            //from here on there must be an if else chain for each act's monsters
            lastName.add("Rat");
            weightLast.add(20);
            lastName.add("Dog");
            weightLast.add(20);
            lastName.add("Lizard");
            weightLast.add(20);
            lastName.add("Spider");
            weightLast.add(20);
            lastName.add("Raven");
            weightLast.add(20);
        }
        // this function will set each names of the monsters in order (if they should (based on chance))

        String firstString = selectName(firstName, weightFirst, false);
        returnedName += firstString;
        String secondString = selectName(middleName, weightMiddle, false);
        returnedName += secondString;
        String thirdString = selectName(lastName, weightLast, true);
        returnedName += thirdString;
        
        
        

        return returnedName;
    }
    
    
    public boolean isName(int chance){
        int randomNumber = (int) (Math.random() * (101 - 1)) + 1;
        
        if (randomNumber < chance)
            return true;
        else return false;
    }
    
    public String selectName(ArrayList names, ArrayList weight, boolean isLastName){ //firstName firstWeight

        ArrayList<String> namesLocal = names;
        ArrayList<Integer> weightLocal = weight;
        
        ArrayList<String> fullList = new ArrayList<String>();
        
        Random rand = new Random();
        
        
        
        // 
        for (int i = 0; i < names.size(); i++) {
            
           boolean isName; //will be used as a percentage that must be achieved to generate the name
            // this checks each act and sets the chance of first and middle name occuring (one for each act)
            if (GameLogic.act != 0) { //here will be == 1, for example
                isName = isName(95); //50% chance
                if (isLastName)
                    isName = true;
                if (isName){
                    for (int j = 0; j < weightLocal.get(i); j++){
                        fullList.add(namesLocal.get(i));      
                    }
                } else return "";
                        
            }
        }
        
        int randomArraySelector = rand.nextInt(fullList.size()); //will genearate a number equal to ArrayList size
        
        
        String returnString;
        
        if (isLastName)    
            returnString = fullList.get(randomArraySelector);
        else 
            returnString = fullList.get(randomArraySelector) + " ";
        
        
        return returnString;
    }

}
